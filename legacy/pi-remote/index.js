export default async function (pi) {
  console.warn("\x1b[41m\x1b[37m ⚠️  DEPRECATION WARNING \x1b[0m");
  console.warn("\x1b[33m%s\x1b[0m", "The 'pi-remote' extension is deprecated and has been renamed to '@wherever-dev/pi'.\n");
  console.warn("To migrate, please run the following commands in your terminal:");
  console.warn("\x1b[32m%s\x1b[0m", "  pi uninstall npm:pi-remote");
  console.warn("\x1b[32m%s\x1b[0m", "  pi install npm:@wherever-dev/pi\n");
}
