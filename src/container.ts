import { Token, INJECTABLE_METADATA, INJECT_METADATA } from './tokens';
import type { Scope } from './decorators';

export type Constructor<T = unknown> = new (...args: any[]) => T;

function isToken(value: unknown): value is Token {
    return typeof value === 'symbol' || typeof value === 'string';
}

export class Container {
    private readonly instances = new Map<Constructor, unknown>();
    private readonly providers = new Map<Token, Constructor>();
    private readonly values = new Map<Token, unknown>();

    register<T>(token: Token<T>, provider: Constructor<T>): this {
        this.providers.set(token, provider);
        return this;
    }

    /** Value provider (Nest's `useValue`): a ready object instead of a class. */
    registerValue<T>(token: Token<T>, value: T): this {
        this.values.set(token, value);
        return this;
    }

    get<T>(token: Token<T>): T {
        if (this.values.has(token)) {
            return this.values.get(token) as T;
        }

        const provider = this.providers.get(token);

        if (!provider) {
            throw new Error(`Provider for token ${String(token)} is not registered`);
        }

        return this.resolve(provider) as T;
    }

    public resolve<T>(token: Constructor<T> | Token, path: Set<Constructor> = new Set()): T {
        let provider: Constructor;

        if (isToken(token)) {
            if (this.values.has(token)) {
                return this.values.get(token) as T;
            }

            const registered = this.providers.get(token);
            if (!registered) {
                throw new Error(`Provider for token ${String(token)} is not registered`);
            }
            provider = registered;
        } else {
            provider = token;
        }

        if (path.has(provider)) {
            const chain = [...path, provider].map((p) => p.name).join(' -> ');
            throw new Error(`Circular dependency detected: ${chain}`);
        }

        const nextPath = new Set(path);
        nextPath.add(provider);

        const metadata = Reflect.getMetadata(INJECTABLE_METADATA, provider) as
            { scope: Scope } | undefined;

        if (!metadata) {
            const chain = [...path, provider].map((p) => p.name).join(' -> ');
            throw new Error(`${provider.name} is not injectable (via ${chain})`);
        }

        const scope: Scope = metadata.scope ?? 'singleton';

        if (scope === 'singleton' && this.instances.has(provider)) {
            return this.instances.get(provider) as T;
        }

        const dependencies =
            (Reflect.getMetadata('design:paramtypes', provider) as Constructor[] | undefined) ?? [];

        const injects =
            (Reflect.getOwnMetadata(INJECT_METADATA, provider) as
                Record<number, Token> | undefined) ?? {};

        const instances = dependencies.map((dependency, index) => {
            if (injects[index] !== undefined) {
                return this.resolve(injects[index], nextPath);
            }
            return this.resolve(dependency, nextPath);
        });

        const instance = new provider(...instances);

        if (scope === 'singleton') {
            this.instances.set(provider, instance);
        }

        return instance as T;
    }
}
