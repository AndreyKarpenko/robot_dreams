import { Token, INJECTABLE_METADATA, INJECT_METADATA } from "./tokens";

type Constructor<T = unknown> =
    new (...args: any[]) => T

export class Container {
    private instances = new Map();

    private providers = new Map<symbol, Constructor>()

    register<T>(
        token: Token<T>,
        provider: Constructor<T>
    ) {
        this.providers.set(token, provider)
    }

    get<T>(token: Token<T>): T {
        const provider = this.providers.get(token)

        if (!provider) {
            throw new Error('Provider not found')
        }

        return this.resolve(provider) as T
    }

    public resolve<T>(
        token: Constructor<T> | Token<T>,
        path: Set<Constructor> = new Set()
    ): T {

        let provider: any;
        const nextPath = new Set(path);

        if (typeof token === 'symbol') {
            provider = this.providers.get(token);
            if (!provider) {
                throw new Error(`Provider for token ${String(token)} is not registered`);
            }
        } else {
            provider = token;
        }

        if(path.has(provider)) {
            throw new Error(`Circular dependency detected: ${[...path, provider].map(p => p.name).join(' -> ')}`)
        }
        nextPath.add(provider);


        const metadata = Reflect.getMetadata(
            INJECTABLE_METADATA,
            provider,
        );

        if(!metadata) {
            throw new Error(`${provider.name} is not injectable`)
        }

        if (metadata.scope === 'singleton') {
            if(this.instances.has(provider)){
                return this.instances.get(provider) as T;
            }
        }
        const dependencies =
            Reflect.getMetadata(
            'design:paramtypes',
            provider
        ) as Constructor[] ?? []

        const injects = Reflect.getMetadata(
            INJECT_METADATA,
            provider,
        ) ?? {};

        const instances = dependencies.map(
            (dependency, index) => {
                if(injects[index] !== undefined) {
                    return this.resolve(injects[index], nextPath)
                }
                return this.resolve(dependency, nextPath)
            }
        )

        const instance = new provider(...instances as any[]);

        if (metadata.scope === 'singleton') {
            this.instances.set(provider, instance);
        }

        return instance;
    }
}