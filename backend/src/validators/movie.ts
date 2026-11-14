import { z } from 'zod';
import { movieGenres } from '../utils/genres';
import { movieStatus, type MovieStatus } from '../utils/constants';
import { movieLanguages } from '../utils/languages';
import { movieCertifications } from '../utils/certifications';

export const paginationSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20)
});

const movieStatusValues = Object.values(movieStatus) as [MovieStatus, ...MovieStatus[]];

export const listMovieQuerySchema = paginationSchema.extend({
    q: z.preprocess(
        (value) => (typeof value === 'string' ? value.trim() || undefined : value),
        z.string().min(1).max(100).optional(),
    ),
    genre: z.enum(movieGenres).optional(),
    language: z.preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() || undefined : value),
        z.enum(movieLanguages).optional(),
    ),
    certification: z.preprocess(
        (value) => (typeof value === 'string' ? value.trim().toUpperCase() || undefined : value),
        z.enum(movieCertifications).optional(),
    ),
    status: z.enum(movieStatusValues).optional(),
    sortBy: z.enum(['ratingAvg', 'ratingCount', 'releaseDate', 'createdAt', 'title']).default('releaseDate'),
    order: z.enum(['asc', 'desc']).default('desc'),
});

export type ListMovieQuery = z.infer<typeof listMovieQuerySchema>;