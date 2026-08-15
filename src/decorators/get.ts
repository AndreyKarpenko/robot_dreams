export function Get(path: string) {
    return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
        const metadata = Reflect.getMetadata('routes', target) ?? [];

        Reflect.defineMetadata(
            'routes',
            [
                ...metadata,
                {
                    method: 'GET',
                    path,
                    handler: propertyKey,
                },
            ],
            target,
        );
    };
}
