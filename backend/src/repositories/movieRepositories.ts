import Movie from '../models/Movie';
import type { ListMovieQuery } from '../validators/movie';

export const listMovie = async (query: ListMovieQuery) => {
    const { q, genre, language, certification, status, sortBy, order, page, limit } = query;
    const filter: Record<string, unknown> = {};

    if (q) {
        filter.$text = { $search: q };
    }

    if (genre) {
        filter.genres = genre;
    }

    if (language) {
        filter.language = language;
    }

    if (certification) {
        filter.certification = certification;
    }

    if (status) {
        filter.status = status;
    }

    const sort: Record<string, 1 | -1> = {
        [sortBy]: order === 'asc' ? 1 : -1,
    };

    const skip = (page - 1) * limit;
    const moviesQuery = q
        ? Movie.find(filter, { score: { $meta: 'textScore' } }).sort({
              score: { $meta: 'textScore' },
              ...sort,
          })
        : Movie.find(filter).sort(sort);

    const [movies, total] = await Promise.all([
        moviesQuery.skip(skip).limit(limit).lean(),
        Movie.countDocuments(filter),
    ]);

    return {
        movie: movies,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};