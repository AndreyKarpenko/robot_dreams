import { INJECTABLE_METADATA } from '../tokens';

export type Scope = 'singleton' | 'transient';

export type InjectableOptions = {
    scope?: Scope;
};

export function Injectable(options: InjectableOptions = {}) {
    const scope: Scope = options.scope ?? 'singleton';

    return function (target: Function) {
        Reflect.defineMetadata(INJECTABLE_METADATA, { scope }, target);
    };
}
