import { INJECTABLE_METADATA } from "../tokens";

type Scope = 'singleton' | 'transient';

export function Injectable({ scope }: { scope?: Scope} = { scope: 'singleton' }) {
    return function(target: Function) {
        Reflect.defineMetadata(INJECTABLE_METADATA, { scope }, target)
    }
}