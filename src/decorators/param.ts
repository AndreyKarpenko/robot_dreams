export function Param(name: string) {
    return function (target: object, propertyKey: string | symbol, parameterIndex: number) {
        const metadata = Reflect.getMetadata('parameters', target) ?? {};

        const key = metadata[propertyKey] ?? {};
        key[parameterIndex] = { type: 'param', name };
        metadata[propertyKey] = key;

        Reflect.defineMetadata('parameters', metadata, target);
    };
}
