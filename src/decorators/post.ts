export function Post(path?: string) {
    return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
        const metadata = Reflect.getMetadata('routes', target) ?? [];

        Reflect.defineMetadata(
            'routes',
            [
                ...metadata,
                {
                    method: 'POST',
                    path,
                    handler: propertyKey,
                },
            ],
            target,
        );
    };
}
