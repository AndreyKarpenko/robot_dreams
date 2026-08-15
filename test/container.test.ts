import 'reflect-metadata';

import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '../src/container';
import { Injectable } from '../src/decorators/injectable';
import { Inject } from '../src/decorators/inject';
import { CONFIG } from '../src/tokens';

describe('IoC Container', () => {
    let container: Container;

    beforeEach(() => {
        container = new Container();
    });

    it('resolves a simple dependency graph A -> B -> C', () => {
        @Injectable()
        class C {
            readonly marker = 'C';
        }

        @Injectable()
        class B {
            constructor(public readonly c: C) {}
        }

        @Injectable()
        class A {
            constructor(public readonly b: B) {}
        }

        const a = container.resolve(A);

        expect(a).toBeInstanceOf(A);
        expect(a.b).toBeInstanceOf(B);
        expect(a.b.c).toBeInstanceOf(C);
        expect(a.b.c.marker).toBe('C');
    });

    it('returns the same instance for singleton (default scope)', () => {
        @Injectable()
        class X {}

        const first = container.resolve(X);
        const second = container.resolve(X);

        expect(first).toBe(second);
    });

    it('returns a new instance for transient scope', () => {
        @Injectable({ scope: 'transient' })
        class X {}

        const first = container.resolve(X);
        const second = container.resolve(X);

        expect(first).not.toBe(second);
    });

    it('resolves @Inject(token) by token, not by erased interface type', () => {
        @Injectable()
        class ConfigService {
            readonly url = 'https://example.com';
        }

        @Injectable()
        class Consumer {
            constructor(@Inject(CONFIG) public readonly config: ConfigService) {}
        }

        container.register(CONFIG, ConfigService);

        const consumer = container.resolve(Consumer);

        expect(consumer.config).toBeInstanceOf(ConfigService);
        expect(consumer.config.url).toBe('https://example.com');
        expect(container.get(CONFIG)).toBe(consumer.config);
    });

    it('throws a readable error for circular dependencies', () => {
        @Injectable()
        class A {
            constructor(@Inject('B') public readonly b: unknown) {}
        }

        @Injectable()
        class B {
            constructor(@Inject('A') public readonly a: unknown) {}
        }

        container.register('A', A);
        container.register('B', B);

        expect(() => container.resolve(A)).toThrowError(/A -> B -> A/);

        try {
            container.resolve(A);
            expect.unreachable('expected circular dependency error');
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect(error).not.toBeInstanceOf(RangeError);
            expect((error as Error).message).toMatch(/A -> B -> A/);
        }
    });

    it('does not leak @Inject tokens from parent to child class', () => {
        const PARENT = Symbol.for('PARENT_DEP');
        const CHILD = Symbol.for('CHILD_DEP');

        @Injectable()
        class ParentDep {
            readonly kind = 'parent';
        }

        @Injectable()
        class ChildDep {
            readonly kind = 'child';
        }

        @Injectable()
        class Parent {
            constructor(@Inject(PARENT) public readonly dep: ParentDep) {}
        }

        @Injectable()
        class Child extends Parent {
            constructor(@Inject(CHILD) dep: ChildDep) {
                super(dep as unknown as ParentDep);
            }
        }

        container.register(PARENT, ParentDep);
        container.register(CHILD, ChildDep);

        const child = container.resolve(Child);
        expect(child.dep).toBeInstanceOf(ChildDep);
        expect(child.dep.kind).toBe('child');

        const parent = container.resolve(Parent);
        expect(parent.dep).toBeInstanceOf(ParentDep);
        expect(parent.dep.kind).toBe('parent');
    });

    it('names the request path when a dependency is not injectable', () => {
        class Plain {}

        @Injectable()
        class NeedsPlain {
            constructor(public readonly plain: Plain) {}
        }

        expect(() => container.resolve(NeedsPlain)).toThrowError(
            /Plain is not injectable \(via NeedsPlain -> Plain\)/,
        );
    });
});
