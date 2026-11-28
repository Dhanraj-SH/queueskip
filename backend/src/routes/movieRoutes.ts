import { Router } from "express";
import { getMovie, getMovieList, searchMovies } from "../controller/movieController";
import { searchRateLimit } from "../middleware/searchRateLimit";

const router = Router();

router.get("/", searchRateLimit, getMovieList);
router.get("/search", searchRateLimit, searchMovies);
router.get("/:id", getMovie);

export default router;