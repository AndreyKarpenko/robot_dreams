import { Token, INJECTABLE_METADATA } from "./tokens";

type Constructor<T = unknown> =
    new (...args: any[]) => T

export class Container {
    private instances = new Map();

    public resolve<T>(
        provider: Constructor<T>
    ): T {
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

        const instances = dependencies.map(
            dependency => this.resolve(dependency)
        )

        const instance = new provider(...instances as any[]);

        if (metadata.scope === 'singleton') {
            this.instances.set(provider, instance);
        }

        return instance;
    }
}