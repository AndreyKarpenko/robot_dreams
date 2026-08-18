export type RouteParamType = 'body' | 'param' | 'query';

export type RouteParamMetadata = {
    type: RouteParamType;
    name?: string;
};

function createParamDecorator(type: RouteParamType) {
    return (name?: string): ParameterDecorator => {
        return (target, propertyKey, parameterIndex) => {
            if (propertyKey === undefined) {
                return;
            }

            const existing: Record<number, RouteParamMetadata> =
                Reflect.getMetadata('parameters', target, propertyKey) ?? {};

            Reflect.defineMetadata(
                'parameters',
                {
                    ...existing,
                    [parameterIndex]: { type, name },
                },
                target,
                propertyKey,
            );
        };
    };
}

export function Body() {
    return createParamDecorator('body')();
}

export function Param(name: string) {
    return createParamDecorator('param')(name);
}

export function Query(name: string) {
    return createParamDecorator('query')(name);
}
