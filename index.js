const express = require("express");
const expressRange = require("express-range");
const app = express();
const http = require("http");
const socketIO = require("socket.io");
/** @type {typeof import("node-fetch").default} */
const fetch = require("node-fetch");
const crypto = require("crypto");
const ffmpegStatic = require("ffmpeg-static");

const { JobSources, Jobs, JobChunks } = require("./database");
const server = http.createServer(app);
const io = new socketIO.Server(server);

const serverAPIRouter = express.Router();

app
    .use(express.json())
    .all("/api", serverAPIRouter)
    .get("/", express.static("./public"));

/**
 * @param {express.Response} res
 * @param {{
 *  size: number,
 *  chunk: string[]
 * }} assembledData
 * @param {{
 *  unit: string,
 *  first?: number,
 *  last?: number,
 *  suffix?: number
 * }} range
 * @param {string} contentType
 * @param {string?} multi
 */
async function downloadChunkData(assembledData, res, range, contentType, multi) {
    let maxSize = range.unit === "bytes" ? assembledData.size : assembledData.chunk.length;

    let blockStart = null, blockEnd = null;
    if (typeof range.suffix === "number") {
        blockEnd = maxSize - 1;
        blockStart = maxSize + range.suffix
    } else {
        blockStart = Math.min(range.first, maxSize)
        blockEnd = Math.min(range.last ?? (maxSize - 1), maxSize);
    }
    if (multi) {
        res.write(`--${multi}\r\nContent-Type: ${contentType}\r\nContent-Range: ${range.unit} ${blockStart}-${blockEnd}/${maxSize}\r\n\r\n`);
    } else {
        res.setHeader("Content-Type", contentType);
        if (range.first !== 0 || typeof range.last === "number") {
            res.setHeader("Content-Range", `${range.unit} ${blockStart}-${blockEnd}/${maxSize}`);
        }
    }

    let firstBytes = range.unit === "bytes" ? blockStart : blockStart * 1048576;
    let lastBytes = range.unit === "bytes" ? blockStart : blockStart * 1048576;
    if (!multi) {
        res.setHeader("Content-Length", lastBytes - firstBytes);
    }

    let firstChunk = Math.floor(firstBytes / 1048576);
    let lastChunk = Math.floor(lastBytes / 1048576);
    let firstChunkOffset = firstBytes % 1048576;
    let lastChunkOffset = lastBytes % 1048576;

    /** @type {(() => Promise<import("node-fetch").Response>)[]} */
    let preload = [];
    for (let i = firstChunk; i <= lastChunk; i++) {
        let addHeaders = {};
        if (i === firstChunk && firstChunkOffset !== 0 && i === lastChunk && lastChunkOffset !== 1048575) {
            addHeaders["Range"] = `bytes=${firstChunkOffset}-${lastChunkOffset}`;
        } else if (i === firstChunk && firstChunkOffset !== 0) {
            addHeaders["Range"] = `bytes=${firstChunkOffset}-`;
        } else if (i === lastChunk && lastChunkOffset !== 1048575) {
            addHeaders["Range"] = `bytes=0-${lastChunkOffset}`;
        }

        if (i < assembledData.chunk.length)
            preload.push((
                (ah, cid) =>
                    () => fetch(`https://ipfs.infura.io/ipfs/${cid}`, {
                        headers: ah
                    })
            )(addHeaders, assembledData.chunk[i]));
    }
    /** @type {Promise<import("node-fetch").Response>[]} */
    let read = [];
    for (let i = 0; i < 8; i++) read.push(preload.shift()?.());
    preload = preload.filter(x => x);

    /** @type {import("node-fetch").Response} */
    let r;
    while (r = await read.shift()) {
        r.body.pipe(res);

        let resolve, p = new Promise(r => resolve = r);
        r.body.on("end", resolve);

        await p;

        let newPreload = preload.shift()?.();
        if (newPreload) preload.push(newPreload);
    }
}

function getContentType(codec) {
    switch (codec) {
        case "h264":
        case "h265":
            return "video/mp4";
        case "vp9":
            return "video/webm";
        default:
            return "application/octet-stream";
    }
}

serverAPIRouter
    .use(async (req, res, next) => {
        if (req.body.AUTH_PASSWORD === process.env.API_PASSWORD) {
            next();
        } else {
            res.status(403).json({
                error: "Invalid API password"
            });
        }
    })
    .get("/verify", (_req, res) => res.status(200).json({ success: true }))
    .get("/source/:id", async (req, res) => {
        let jobsSrc = await JobSources.findAndCountAll({
            where: {
                finishedTime: null,
                finishedReason: null,
                ...(!isNaN(+req.params.id) ? { id: +req.params.id } : null)
            },
            limit: 5,
            offset: (Math.max(isNaN(+req.body.page) ? 1 : +req.body.page, 1) - 1) * 5
        });

        return res.status(200).json({
            success: true,
            page: Math.max(isNaN(+req.body.page) ? 1 : +req.body.page, 1),
            maxPage: Math.ceil(jobsSrc.count / 5),
            count: jobsSrc.count,
            src: await Promise.all(jobsSrc.rows.map(async s => {
                let job = await JobSources.findAll({
                    where: {
                        sourceID: s.id
                    }
                });

                return {
                    id: s.id,
                    jobs: await Promise.all(job.map(async j => {
                        return {
                            id: j.id,
                            width: j.width,
                            height: j.height,
                            framerate: j.framerate,
                            bitrate: j.bitrate,
                            codec: j.codec,
                            codecSettings: j.codecSettings,
                            chunkCount: j.chunks,
                            finished: j.finished
                        }
                    })),
                    videoSource: s.videoSource,
                    subtitleSource: s.subtitleSource,
                    added: s.addedTime,
                    finished: s.finishedTime,
                    finishReason: s.finishReason
                }
            }))
        });
    })
    .get("/job/:id", async (req, res) => {
        if (isNaN(+req.params.id)) return res.status(400).json({ error: "Job ID is required." });
        let j = await Jobs.findOne({
            where: {
                id: +req.params.id
            }
        });
        if (!j) return res.status(404).json({ error: "Job ID not found." });

        return {
            id: j.id,
            width: j.width,
            height: j.height,
            framerate: j.framerate,
            bitrate: j.bitrate,
            codec: j.codec,
            codecSettings: j.codecSettings,
            chunkCount: j.chunks,
            finished: j.finished,
            chunks: (await JobChunks.findAll({
                where: {
                    mainJob: j.id
                }
            })).map(c => ({
                id: c.id,
                chunkOffset: c.chunkOffset,
                assignedTo: c.assignedTo,
                chunkResult: c.result,
                status: c.status
            })).sort((a, b) => a.chunkOffset - b.chunkOffset)
        }
    })
    .use("/download", expressRange({
        accept: ["bytes", "rawchunk"]
    }))
    .head("/download/:id", async (req, res) => {
        if (isNaN(+req.params.id)) return res.status(400);
        let j = await Jobs.findOne({
            where: {
                id: +req.params.id
            }
        });
        if (!j) return res.status(404);

        if (!j.assembledData || !j.finished) return res.status(404);

        res.status(200);
        res.setHeader("Content-Type", getContentType(j.codec));
        res.setHeader("Content-Length", JSON.parse(j.assembledData).size);
    })
    .get("/download/:id", async (req, res) => {
        if (isNaN(+req.params.id)) return res.status(400).json({ error: "Job ID is required." });
        let j = await Jobs.findOne({
            where: {
                id: +req.params.id
            }
        });
        if (!j) return res.status(404).json({ error: "Job ID not found." });

        if (!j.assembledData || !j.finished) return res.status(404).json({ error: "Job is not finished." });

        if (req.range) {
            // Only download specific range
            res.status(206);
            if (req.range.ranges) {
                // Multiple ranges? hmmm ok
                let boundary = crypto.randomBytes(30).toString("hex");
                res.setHeader("Content-Type", `multipart/byteranges; boundary=${boundary}`);
                res.setHeader("Content-Length", req.range.ranges.reduce((a, v) => a + v.last - v.first + 1, 0));

                for (let range in req.range.ranges) {
                    await downloadChunkData(JSON.parse(j.assembledData), res, {
                        ...range,
                        unit: req.range.unit
                    }, getContentType(j.codec), true);
                }
                res.close();
            } else {
                await downloadChunkData(JSON.parse(j.assembledData), res, req.range, getContentType(j.codec), false);
                res.close();
            }
        } else {
            // Download and stream everything
            res.status(200);
            await downloadChunkData(JSON.parse(j.assembledData), res, {
                unit: "bytes",
                first: 0
            }, getContentType(j.codec), false);
            res.close();
        }
    })
    .all("/", (req, res) => res.status(400).json({
        error: "API not found"
    }));

server.listen(process.env.PORT || 3000, () => {
    console.log(`Server started listening at port ${server.address().port}.`);
});
