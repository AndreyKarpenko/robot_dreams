type HttpMethod = 'GET' | 'POST';

export type RouteDefinition = {
    method: HttpMethod;
    path: string;
    handler: string | symbol;
};

function createMethodDecorator(method: HttpMethod) {
    return (path = '') => {
        return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
            const routes: RouteDefinition[] = Reflect.getMetadata('routes', target) ?? [];

            Reflect.defineMetadata(
                'routes',
                [
                    ...routes,
                    {
                        method,
                        path,
                        handler: propertyKey,
                    },
                ],
                target,
            );
        };
    };
}

export const Get = createMethodDecorator('GET');
export const Post = createMethodDecorator('POST');
