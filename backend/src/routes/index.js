/* Route mounting — the single map of the REST API. */
const { Router } = require("express");

module.exports = function mountRoutes() {
  const router = Router();
  router.get("/health", (_req, res) => res.json({ ok: true, service: "campuscore-api", time: new Date().toISOString() }));
  router.use("/auth", require("../modules/auth"));
  router.use("/", require("../modules/catalog"));       // /students /faculty /courses /departments /programs
  router.use("/", require("../modules/academic"));      // /attendance /marks /results /exams /timetable /assignments
  router.use("/", require("../modules/office"));        // /fees /requests /notifications
  router.use("/", require("../modules/dashboard"));     // /dashboard/* /search /admin/reset-demo
  router.use("/", require("../modules/academicProfile")); // /academic-profile/*
  router.use("/ai", require("../modules/ai"));          // /ai/chat /ai/config
  return router;
};
