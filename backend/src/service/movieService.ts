import { listMovie } from '../repositories/movieRepositories';
import type { ListMovieQuery } from '../validators/movie';

export const listMovieService = async (query: ListMovieQuery) => {
    return listMovie(query);
};