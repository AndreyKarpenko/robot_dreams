import type { GuardRef, InterceptorRef } from '../lifecycle';

export const GUARDS_METADATA = Symbol.for('GUARDS_METADATA');
export const INTERCEPTORS_METADATA = Symbol.for('INTERCEPTORS_METADATA');

type ClassOrMethodDecorator = ClassDecorator & MethodDecorator;

function attach(metadataKey: symbol, values: unknown[]): ClassOrMethodDecorator {
    const decorator = (target: object, propertyKey?: string | symbol): void => {
        if (propertyKey === undefined) {
            Reflect.defineMetadata(metadataKey, values, target);
            return;
        }

        Reflect.defineMetadata(metadataKey, values, target, propertyKey);
    };

    return decorator as ClassOrMethodDecorator;
}

/** Works on a controller (all its routes) or on a single handler. */
export function UseGuards(...guards: GuardRef[]): ClassOrMethodDecorator {
    return attach(GUARDS_METADATA, guards);
}

export function UseInterceptors(...interceptors: InterceptorRef[]): ClassOrMethodDecorator {
    return attach(INTERCEPTORS_METADATA, interceptors);
}
