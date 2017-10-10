const BROADCAST_INTERVAL = 3000;

const winston = require('winston');
const path = require('path');

// Instances of ConnectionController require a logger
// that has a `log` method. If none is passed, a default
// winston logger is created
const getDefaultLogger = () => {
    const LOG_FILE = path.join(__dirname, 'mission-game-server.log');
    return new winston.Logger({
        level: 'verbose',
        transports: [
            new winston.transports.Console(),
            new winston.transports.File({filename: LOG_FILE})
        ]
    });
};

// The other services in the package reference users from
// a user service. If this dependency is not passed by the
// client, a default one is created.
const getDefaultUserService = (logger) => {
    return require('./DefaultUserService')(logger);
};

// Utility function for promisifying setTimeout
const getTimer = (time) => {
    return new Promise(resolve => setTimeout(resolve, time));
};

module.exports = {
    listen: (io, {
        logger = getDefaultLogger(),
        UserService = getDefaultUserService(logger)
    } = {}) => {
        const GameService = require('./GameService')(UserService, logger);
        const LobbyService = require('./LobbyService')(UserService, logger);

        let count = 0;
        let markLobbyChanged;

        // Converts user IDs to a human-readable format
        const mapLobbyGame = ({id, host, type, players}) => {
            return {
                id,
                type,
                host: UserService.getUserName(host),
                players: players.map(UserService.getUserName)
            };
        };

        // Converts user IDs to a human-readable format
        const mapPlayedGame = (game) => {
            return Object.assign({}, game, {
                players: game.players.map(UserService.getUserName)
            });
        };

        // Sends update for a given lobby entry to all players in that room
        const broadcastLobbyGameUpdate = (game) => {
            game.players.forEach(socketId => {
                const socket = io.sockets.connected[socketId];
                if(socket) {
                    socket.emit('lobby', {
                        type: 'room-update',
                        room: mapLobbyGame(game),
                        isUserHost: socketId === game.host
                    });
                }
            });
        };

        // Sends update regarding lobby room removal to all players in that room
        const broadcastLobbyGameRemoval = (game) => {
            game.players.forEach(socketId => {
                const socket = io.sockets.connected[socketId];
                if(socket) {
                    socket.emit('lobby', {
                        type: 'room-cancelled',
                        room: mapLobbyGame(game)
                    });
                }
            });
        };

        // Sends lobby data to single user
        const unicastLobby = (socket) => {
            socket.emit('lobby', {
                type: 'listing',
                rooms: {
                    local: LobbyService.getNearbyGames(socket.id),
                    password: LobbyService.getPasswordProtectedGames()
                }
            });
        };

        // Sends lobby data to all users
        const broadcastLobby = () => {
            Object.entries(io.sockets.connected)
                .forEach(([id, socket]) => unicastLobby(socket));
        };

        // Sends game state to each player in a game in progress
        const broadcastGameDetails = (game) => {
            game.players.map(playerId => io.sockets.connected[playerId])
                .filter(Boolean).forEach(socket => {
                    socket.emit('game', mapPlayedGame(GameService.getPlayerGameInfo(game.id, socket.id)));
                });
        };

        // Starts a timer that periodically sends lobby to all users,
        // but waits until at least one update has occurred
        (function timeout() {
            const updatePromise = new Promise(resolve => markLobbyChanged = resolve);
            Promise.all([getTimer(BROADCAST_INTERVAL), updatePromise]).then(() => {
                broadcastLobby();
                timeout();
            });
        })();

        LobbyService.addEventListener('change', () => markLobbyChanged());
        LobbyService.addEventListener('host', broadcastLobbyGameUpdate);
        LobbyService.addEventListener('join', broadcastLobbyGameUpdate);
        LobbyService.addEventListener('leave', broadcastLobbyGameUpdate);
        LobbyService.addEventListener('cancel', broadcastLobbyGameRemoval);
        LobbyService.addEventListener('gamestart', (game) => {
            GameService.startGame(game.players);
        });

        GameService.addEventListener('start', broadcastGameDetails);
        GameService.addEventListener('update', broadcastGameDetails);

        io.on('connection', (socket) => {
            const {id} = socket;

            logger.log('verbose', `Player connected ${id}`);

            const setName = username => {
                UserService.setUserName(id, username);
                socket.emit('userdata', {username});
            };

            // Default name
            setName('User#' + ++count);

            // Immediate send lobby to new user
            unicastLobby(socket);

            socket.on('userdata', ({username, coords}) => {
                try {
                    if(username) {
                        // Updating username
                        setName(username);
                        logger.log('verbose', `Player ${id} changed name to ${username}`);
                    }
                    if(coords) {
                        // Updating geolocation
                        LobbyService.setUserLocation(id, coords);
                        unicastLobby(socket);
                    }
                } catch(e) {
                    logger.log('error', e);
                    socket.emit('service-error', e.message);
                }
            });

            socket.on('game', (message) => {
                try {
                    const { action } = message;
                    switch(action) {
                    case 'move':
                        GameService.applyMove(
                            GameService.getGamesFor(id)[0],
                            id,
                            message
                        );
                        break;
                    }
                } catch(e) {
                    logger.log('error', e);
                    socket.emit('service-error', e.message);
                }
            });

            socket.on('lobby', (message) => {
                try {
                    const { action } = message;
                    switch(action.toLowerCase()) {
                    case 'host': {
                        LobbyService.hostGame(id, message.room);
                        markLobbyChanged();
                        break;
                    }
                    case 'join':
                        LobbyService.joinGame(id, message);
                        markLobbyChanged();
                        break;
                    case 'start':
                        LobbyService.startGame(id);
                        markLobbyChanged();
                        break;
                    case 'leave':
                        LobbyService.leaveGames(id);
                        markLobbyChanged();
                        break;
                    default:
                        throw new Error('Illegal lobby action');
                    }
                } catch(e) {
                    logger.log('error', e);
                    socket.emit('service-error', e.message);
                }
            });

            socket.on('disconnect', () => {
                LobbyService.leaveGames(id);
                UserService.handleLogout(id);
            });
        });
    }
};
