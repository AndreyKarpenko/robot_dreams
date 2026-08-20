import { z } from 'zod';

export const createUserSchema = z.object({
    email: z.email({ error: 'email must be a valid email address' }),
    name: z.string().min(2, { error: 'name must contain at least 2 characters' }).optional(),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
