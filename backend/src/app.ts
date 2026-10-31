import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "100kb" }));

app.get("/healthz", (_req, res) => {
    res.status(200).json({data: {status: "ok"}});
});

export default app;