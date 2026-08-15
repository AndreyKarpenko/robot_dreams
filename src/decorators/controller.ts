export function Controller(path: string) {
    return function (target: Function) {
        Reflect.defineMetadata('path', path, target);
    };
}
