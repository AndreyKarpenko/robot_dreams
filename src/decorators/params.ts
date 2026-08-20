import type { PipeRef, RouteParamType } from '../lifecycle';

export type { RouteParamType };

export type RouteParamMetadata = {
    type: RouteParamType;
    name?: string;
    pipes: PipeRef[];
};

function createParamDecorator(
    type: RouteParamType,
    name: string | undefined,
    pipes: PipeRef[],
): ParameterDecorator {
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
                [parameterIndex]: { type, name, pipes },
            },
            target,
            propertyKey,
        );
    };
}

export function Body(...pipes: PipeRef[]) {
    return createParamDecorator('body', undefined, pipes);
}

export function Param(name: string, ...pipes: PipeRef[]) {
    return createParamDecorator('param', name, pipes);
}

export function Query(name: string, ...pipes: PipeRef[]) {
    return createParamDecorator('query', name, pipes);
}
