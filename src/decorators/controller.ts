import { INJECTABLE_METADATA } from '../tokens';

export function Controller(prefix = '') {
    return function (target: Function) {
        Reflect.defineMetadata(INJECTABLE_METADATA, { scope: 'singleton' }, target);
        Reflect.defineMetadata('path', prefix, target);
    };
}
