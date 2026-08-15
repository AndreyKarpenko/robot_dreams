import { INJECTABLE_METADATA } from '../tokens';

export function Controller(path: string) {
    return function (target: Function) {
        Reflect.defineMetadata(INJECTABLE_METADATA, { scope: 'singleton' }, target);
        Reflect.defineMetadata('path', path, target);
    };
}
