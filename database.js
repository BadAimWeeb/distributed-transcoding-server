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
    videoSource: Sequelize.TEXT,
    subtitleSource: {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: null
    },
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
exports.JobSources = JobSources;
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
    bitrate: Sequelize.INTEGER,
    codec: Sequelize.TEXT,
    codecSettings: Sequelize.TEXT,
    chunks: Sequelize.INTEGER,
    finished: Sequelize.BOOLEAN,
    assemble: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
            key: "id",
            model: WorkerAccounts
        },
        defaultValue: null
    },
    assembledData: {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: null
    }
});
exports.Jobs = Jobs;
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
    chunkOffset: Sequelize.INTEGER,
    assignedTo: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
            key: "id",
            model: WorkerAccounts
        },
        defaultValue: null
    },
    status: {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: null
    },
    result: {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: null
    }
});
exports.JobChunks = JobChunks;
