import { getMovieById, listMovie } from '../repositories/movieRepositories';
import type { ListMovieQuery } from '../validators/movie';

export const listMovieService = async (query: ListMovieQuery) => {
    return await listMovie(query);
};

export const fetchMovieService = async (movieId: string) => {
    return await getMovieById(movieId);
}