import { Router } from "express";
import { createDemoData, deleteDemoData, getDemoRecord } from "../services/demo-data.service.js";

export const demoRouter = Router();

/** ¿Tiene cargados los datos de ejemplo? */
demoRouter.get("/", async (req, res, next) => {
  try {
    res.json({ loaded: (await getDemoRecord(req.user!.userId)) !== null });
  } catch (err) {
    next(err);
  }
});

demoRouter.post("/", async (req, res, next) => {
  try {
    await createDemoData(req.user!.userId);
    res.status(201).json({ loaded: true });
  } catch (err) {
    next(err);
  }
});

demoRouter.delete("/", async (req, res, next) => {
  try {
    const removed = await deleteDemoData(req.user!.userId);
    res.json({ loaded: false, removed });
  } catch (err) {
    next(err);
  }
});
