import type { RequestHandler } from 'express';
import { fetchMovieService, listMovieService, searchMoviesService } from '../service/movieService';
import { listMovieQuerySchema, searchMovieQuerySchema } from '../validators/movie';
import { validateObjectId } from '../validators/common';

export const getMovieList: RequestHandler = async (req, res, next): Promise<void> => {
    try{
        const { movie, meta } = await listMovieService(listMovieQuerySchema.parse(req.query));
    
        res.status(200).json({
            movie,
            meta,
        });
    } catch(error) {
        next(error);
    }
};

export const getMovie: RequestHandler = async (req, res, next): Promise<void> => {
    try {
        const movieId = validateObjectId.parse(req.params.id);
        const movie = await fetchMovieService(movieId);
    
        if(!movie){
            res.status(404).json({
                message: "Movie not found"
            });

            return;
        }

        res.status(200).json({
            movie
        });
    } catch(error) {
        next(error);
    }
};

export const searchMovies: RequestHandler = async (req, res, next): Promise<void> => {
    try {
        const result = await searchMoviesService(searchMovieQuerySchema.parse(req.query));

        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
};