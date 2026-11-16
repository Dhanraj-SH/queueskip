import { Router } from "express";
import { getMovie, getMovieList } from "../controller/movieController";
import { searchRateLimit } from "../middleware/searchRateLimit";

const router = Router();

router.get("/", searchRateLimit, getMovieList);
router.get("/:id", getMovie);

export default router;