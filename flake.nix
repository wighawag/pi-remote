{
  description = "wherever - standalone multi-session server for the pi coding agent";

  # This flake serves HUMANS and CI only: `nix develop` for the toolchain and
  # `nix build` for a local check. It is deliberately NOT the deployment
  # interface -- a consumer imports ./package.nix with its OWN pkgs, so that it
  # never has to pull this flake's nixpkgs into its closure. The pin below is
  # therefore kept LOOSE (a branch, not a rev) on purpose.
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      # Stamp the build with the flake's own rev, so a `nix build` artifact
      # reports which commit produced it. Null outside a git tree, and
      # package.nix then falls back to the package version.
      buildVersion = self.shortRev or self.dirtyShortRev or null;
    in
    {
      packages = forAllSystems (pkgs: {
        wherever = import ./package.nix { inherit pkgs buildVersion; };
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.wherever;

        # `nix run .#update-pnpm-deps-hash` -- rewrites pnpmDepsHash in
        # package.nix after a pnpm-lock.yaml change. The whole `nix/` directory
        # goes into the store (not just the one script) because it sources its
        # sibling `compute-pnpm-deps-hash.sh` relative to itself. It still edits
        # the package.nix of the CHECKOUT you run it from, via
        # WHEREVER_REPO_ROOT, which defaults to $PWD.
        update-pnpm-deps-hash = pkgs.writeShellApplication {
          name = "update-pnpm-deps-hash";
          runtimeInputs = [
            pkgs.nix
            pkgs.gnused
            pkgs.gnugrep
            pkgs.coreutils
          ];
          text = ''
            export WHEREVER_REPO_ROOT="''${WHEREVER_REPO_ROOT:-$PWD}"
            exec ${./nix}/update-pnpm-deps-hash.sh
          '';
        };
      });

      # The dev shell is the FIRST-CLASS output: it is what replaces the
      # volta-shimmed, PATH-dependent toolchain this repo used to assume.
      # `nix develop` gives the exact node + pnpm the lockfile expects, with no
      # global installs and nothing sourced from a login shell.
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          name = "wherever-dev";
          packages = [
            pkgs.nodejs_24
            pkgs.pnpm_10
            # `openssl` is invoked BY NAME by the server to mint its fallback
            # self-signed certificate; `git` is read by the web build to stamp a
            # build id. Both are assumed-present at runtime, so the shell that
            # claims to be a working environment must actually provide them.
            pkgs.openssl
            pkgs.git
          ];
          shellHook = ''
            echo "wherever dev shell: node $(node --version), pnpm $(pnpm --version)"
            echo "  pnpm install && pnpm build   # full build (web -> server/public -> tsc)"
            echo "  pnpm --filter ./server test  # server suite"
          '';
        };
      });

      # `nix flake check` builds the package. NOTE it deliberately does NOT
      # include the pnpmDepsHash staleness guard: that has to hit the npm
      # registry, which a Nix check cannot do. It runs in CI instead
      # (.github/workflows/nix.yml -> nix/check-pnpm-deps-hash.sh).
      checks = forAllSystems (pkgs: {
        package = self.packages.${pkgs.stdenv.hostPlatform.system}.wherever;
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-tree);
    };
}
