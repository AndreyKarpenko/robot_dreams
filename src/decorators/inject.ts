import { Token, INJECT_METADATA } from "../tokens";

export function Inject(token: Token<unknown>) {
    return function (
        target: object,
        propertyKey: string | symbol | undefined,
        parameterIndex: number,
    ) {
        const injects = Reflect.getMetadata(INJECT_METADATA, target) ?? {};
        injects[parameterIndex] = token;
        Reflect.defineMetadata(INJECT_METADATA, injects, target);
    }
}