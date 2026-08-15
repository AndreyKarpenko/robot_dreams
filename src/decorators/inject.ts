import { Token, INJECT_METADATA } from '../tokens';

export function Inject(token: Token) {
    return function (
        target: object,
        _propertyKey: string | symbol | undefined,
        parameterIndex: number,
    ) {
        const existing =
            Reflect.getOwnMetadata(INJECT_METADATA, target) ?? ({} as Record<number, Token>);

        const injects = { ...existing, [parameterIndex]: token };
        Reflect.defineMetadata(INJECT_METADATA, injects, target);
    };
}
