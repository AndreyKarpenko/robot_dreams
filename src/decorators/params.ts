import { z } from 'zod';

export type RouteParamType = 'body' | 'param' | 'query';

export type RouteParamMetadata = {
    type: RouteParamType;
    name?: string;
    schema?: z.ZodType;
};

function createParamDecorator(type: RouteParamType) {
    return ({ name, schema }: { name?: string; schema?: z.ZodType }): ParameterDecorator => {
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
                    [parameterIndex]: { type, name, schema },
                },
                target,
                propertyKey,
            );
        };
    };
}

export function Body(schema?: z.ZodType) {
    return createParamDecorator('body')({ schema });
}

export function Param(name: string) {
    return createParamDecorator('param')({ name });
}

export function Query(name: string) {
    return createParamDecorator('query')({ name });
}
