const express = require("express");
const app = express();
const http = require("http");
const socketIO = require("socket.io");
const ffmpegStatic = require("ffmpeg-static");

const Sequelize = require('sequelize');
const sequelize = new Sequelize.Sequelize(
    ...(
        process.env.FORCE_DATABASE_URL ?? process.env.DATABASE_URL ?
            [process.env.FORCE_DATABASE_URL ?? process.env.DATABASE_URL, {
                dialectOptions: JSON.parse(process.env.FORCE_SQL_OPTIONS ?? process.env.SQL_OPTIONS ?? "null")
            }] :
            [
                process.env.SQL_DATABASE,
                process.env.SQL_USERNAME,
                process.env.SQL_PASSWORD,
                {
                    host: process.env.SQL_SERVER,
                    dialect: process.env.SQL_MODE,
                    pool: {
                        max: 5,
                        min: 0,
                        idle: 10000
                    },
                    storage: process.env.SQL_FILE
                }
            ]
    )
);

let WorkerAccounts = sequelize.define("worker_accounts", {
    id: {
        type: Sequelize.INTEGER,
        primaryKey: true
    },
    username: Sequelize.TEXT,
    password: Sequelize.TEXT
});

let JobSources = sequelize.define("job_source_list", {
    id: {
        type: Sequelize.INTEGER,
        primaryKey: true
    },
    videoSourceURL: Sequelize.TEXT,
    subtitleSourceURL: Sequelize.TEXT,
    addedTime: {
        type: Sequelize.DATE,
        defaultValue: () => new Date()
    },
    finishedTime: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null
    },
    finishedReason: {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: null
    }
});

let Jobs = sequelize.define("job_list", {
    id: {
        type: Sequelize.INTEGER,
        primaryKey: true
    },
    sourceID: {
        type: Sequelize.INTEGER,
        references: {
            key: "id",
            model: JobsSource
        }
    },
    width: Sequelize.INTEGER,
    height: Sequelize.INTEGER,
    framerate: Sequelize.DOUBLE,
    codec: Sequelize.STRING,
    codecSettings: Sequelize.STRING,
    chunks: Sequelize.INTEGER,
    finished: Sequelize.BOOLEAN
});

let JobChunks = sequelize.define("job_chunks", {
    id: {
        type: Sequelize.INTEGER,
        primaryKey: true
    },
    mainJob: {
        type: Sequelize.INTEGER,
        references: {
            key: "id",
            model: Jobs
        }
    },
    chunkID: Sequelize.INTEGER,
    assignedTo: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
            key: "id",
            model: WorkerAccounts
        }
    },
    status: Sequelize.TEXT,
    result: {
        type: Sequelize.TEXT,
        allowNull: true
    }
});

const server = http.createServer(app);
const io = new socketIO.Server(server);

const serverAPIRouter = express.Router();

app
    .use(express.json())
    .all("/api", serverAPIRouter)
    .get("/", express.static("./public"));

serverAPIRouter
    .use((req, res, next) => {
        if (req.body.AUTH_PASSWORD === process.env.API_PASSWORD) {
            next();
        } else {
            res.status(403).json({
                error: "Invalid API password"
            });
        }
    })
    .get("/verify", (_req, res) => res.status(200).json({ success: true }))
    .get("/list_current_jobs", async (req, res) => {
        let jobsSrc = await JobSources.findAndCountAll({
            where: {
                finishedTime: null,
                finishedReason: null
            },
            limit: 5,
            offset: (Math.max(isNaN(+req.body.page) ? 1 : +req.body.page, 1) - 1) * 5
        });

        let jobs
    })
    .all("/", (req, res) => res.status(400).json({
        error: "API not found"
    }));

server.listen(process.env.PORT || 3000, () => {
    console.log(`Server started listening at port ${server.address().port}.`);
});
