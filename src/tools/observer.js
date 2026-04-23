export function getUserFacingToolStatus(event) {
    if (event.type !== 'status') {
        return undefined;
    }
    if (event.toolName === 'reportProgress') {
        return {
            title: 'Progress',
            detail: event.message,
        };
    }
    if (event.toolName === 'requestRequiredAction') {
        return {
            title: 'Needs attention',
            detail: event.message,
        };
    }
    return undefined;
}
export function quoteShellArg(value) {
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
        return value;
    }
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
export async function emitToolEvent(observer, event) {
    await observer?.onToolEvent?.(event);
}
//# sourceMappingURL=observer.js.map