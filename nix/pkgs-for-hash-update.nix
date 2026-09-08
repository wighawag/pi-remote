# A nixpkgs for the hash-maintenance SCRIPTS only (update / check).
#
# Those scripts have to evaluate `package.nix`, which needs a `pkgs` -- but they
# must not force a particular one on anybody: the whole point of package.nix
# being a function of `pkgs` is that the CONSUMER chooses. So this resolves, in
# order: an explicitly-passed nixpkgs, then whatever the flake already locked
# (flake.lock, so the scripts agree with `nix build` in this repo), and only
# then a bare channel lookup.
{
  nixpkgs ? null,
  system ? builtins.currentSystem,
}:

let
  # A minimal stand-in for lib: this file runs BEFORE any nixpkgs is available.
  lib0.assertMsg = cond: msg: if cond then true else throw msg;
  lockPath = ../flake.lock;
  fromLock =
    let
      lock = builtins.fromJSON (builtins.readFile lockPath);
      node = lock.nodes.${lock.nodes.${lock.root}.inputs.nixpkgs};
    in
    # Only the `github` input type is understood here. Switching flake.nix to a
    # `git+https:` / `tarball:` URL, or making nixpkgs a `follows`, would
    # otherwise fail with an obscure missing-attribute error deep in evaluation.
    assert lib0.assertMsg (node.locked.type or null == "github")
      "nix/pkgs-for-hash-update.nix only understands a 'github' nixpkgs input, got '${node.locked.type or "<none>"}'. Update this file alongside flake.nix.";
    # `narHash` from flake.lock is the NAR hash of the unpacked, top-level-stripped
    # tree, which is exactly what fetchTarball content-addresses -- the same
    # technique flake-compat uses.
    builtins.fetchTarball {
      url = "https://github.com/${node.locked.owner}/${node.locked.repo}/archive/${node.locked.rev}.tar.gz";
      sha256 = node.locked.narHash;
    };
in
if nixpkgs != null then
  import nixpkgs { inherit system; }
else if builtins.pathExists lockPath then
  import fromLock { inherit system; }
else
  import <nixpkgs> { inherit system; }
