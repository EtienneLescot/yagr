export function resolvePackageManagerCommand(command, platform = process.platform) {
    return platform === 'win32' ? `${command}.cmd` : command;
}
export function resolvePackageManagerSpawnOptions(platform = process.platform) {
    if (platform === 'win32') {
        return {
            shell: true,
            windowsHide: true,
        };
    }
    return {};
}
//# sourceMappingURL=package-manager.js.map