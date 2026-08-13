import { Token } from "../tokens";

export function Inject(token: Token<unknown>) {
    return function (
        target: object,
        propertyKey: string | symbol | undefined,
        parameterIndex: number,
    ) {

    }
}