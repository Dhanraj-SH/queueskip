import type { RequestHandler } from 'express';
import { listMovieService } from '../service/movieService';
import { listMovieQuerySchema } from '../validators/movie';

export const getMovieList: RequestHandler = async (req, res): Promise<void> => {
    const { movie, meta } = await listMovieService(listMovieQuerySchema.parse(req.query));

    res.status(200).json({
        movie,
        meta,
    });
};