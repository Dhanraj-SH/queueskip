import { getMovieById, listMovie, searchMovies } from '../repositories/movieRepositories';
import type { ListMovieQuery, SearchMovieQuery } from '../validators/movie';

export const listMovieService = async (query: ListMovieQuery) => {
    return await listMovie(query);
};

export const fetchMovieService = async (movieId: string) => {
    return await getMovieById(movieId);
};

export const searchMoviesService = async (query: SearchMovieQuery) => {
    return await searchMovies(query);
};