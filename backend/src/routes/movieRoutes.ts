import { Router } from "express";
import { getMovieList } from "../controller/movieController";
import { searchRateLimit } from "../middleware/searchRateLimit";

const router = Router();

router.get("/", searchRateLimit, getMovieList);

export default router;