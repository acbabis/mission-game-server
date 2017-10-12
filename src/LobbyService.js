const geolib = require('geolib');
const shortid = require('shortid');

// Event for which listeners can be registered
const EVENT_TYPES = [
    'change',
    'host',
    'join',
    'leave',
    'cancel',
    'gamestart'
];

// Physical distance players can be apart and still considered
// in the same party
const MAX_DISTANCE = 20;

// Types of games that can be hosted in the lobby
const TYPE_LOCAL = 'local';
const TYPE_LINK = 'link';
const TYPE_PASSWORD = 'password';

module.exports = (UserService, logger) => {
    const userLocations = {};
    const games = [];

    // Notifies registered (external) event listeners of an event
    const eventHandlers = [];
    const notifyObservers = (type, event, logger) => {
        eventHandlers.filter(observer => observer.type === type)
            .map(({handler}) => handler)
            .forEach(handler => {
                try {
                    handler(event);
                } catch(e) {
                    logger.log('error', e);
                }
            });
    };

    const LobbyService = {
        /**
         * Saves a user's geographical location for party determination purposes
         */
        setUserLocation: (id, {latitude, longitude}) => {
            if(typeof latitude === 'number' && typeof longitude === 'number') {
                userLocations[id] = { latitude, longitude };
            }
        },

        /**
         * Creates a new lobby room with the given host and settings.
         */
        hostGame: (host, {
            type,
            password
        } = {}) => {
            const id = shortid.generate();
            let game;
            if(type === TYPE_LOCAL) {
                game = {
                    id,
                    type,
                    host,
                    players: [host]
                };
            } else if(type === TYPE_LINK) {
                game = {
                    id,
                    type,
                    host,
                    players: [host]
                };
            } else if(type === TYPE_PASSWORD) {
                if(typeof password !== 'string' || password.length > 64) {
                    throw new Error('Illegal password');
                }
                game = {
                    id,
                    type,
                    host,
                    password,
                    players: [host]
                };
            } else {
                throw new Error('Illegal room type');
            }
            LobbyService.leaveGames(host);
            games.push(game);
            notifyObservers('host', game, logger);
            notifyObservers('change', game, logger);
            logger.log('verbose', `${UserService.getUserName(host)} hosting ${game.id}`);
            return game;
        },

        /**
         * Gets a list of games in the player's immediate vicinity, presumably friends'.
         */
        getNearbyGames: (id) => {
            const location = userLocations[id];
            if(!location) {
                return [];
            }
            return games.filter(({type}) => type === TYPE_LOCAL).filter(({host}) => {
                const otherLocation = userLocations[host];
                if(!otherLocation) {
                    return false;
                } else {
                    const distance = geolib.getDistance(location, otherLocation);
                    return distance < MAX_DISTANCE;
                }
            }).map(({id, host, type, players}) => {
                return {
                    id,
                    host,
                    type,
                    players: players.map(id => UserService.getUserName(id))
                };
            });
        },

        /**
         * Gets a list of lobby games for which there is a password
         */
        getPasswordProtectedGames: () => {
            return games.filter(({type}) => type === TYPE_PASSWORD).map(({id, type, host, players}) => {
                return {
                    id,
                    type,
                    host,
                    players: players.map(id => UserService.getUserName(id))
                };
            });
        },

        /**
         * Unregisters user from games they are in
         */
        leaveGames: (userId) => {
            const hostedGame = games.findIndex(game => game.host === userId);
            if(hostedGame >= 0) {
                const game = games.splice(hostedGame, 1)[0];
                notifyObservers('cancel', game, logger);
                notifyObservers('change', game, logger);
                logger.log('verbose', `${UserService.getUserName(userId)} (host) left ${game.id}`);
            }

            games.forEach(({players}) => {
                const index = players.indexOf(userId);
                if(index >= 0) {
                    const game = players.splice(index, 1)[0];
                    notifyObservers('leave', game, logger);
                    notifyObservers('change', game, logger);
                    logger.log('verbose', `${UserService.getUserName(userId)} (player) left ${game.id}`);
                }
            });
        },

        /**
         * Adds user to the specified game
         */
        joinGame: (userId, {id, type, password}) => {
            const game = games.find(game => game.id === id);
            if(!game) {
                throw new Error('No game with matching ID');
            }
            if(type === TYPE_PASSWORD && password !== game.password) {
                throw new Error('Incorrect password');
            }
            const {players} = game;
            if(players.find(player => player === userId)) {
                throw new Error('Already in game');
            }
            if(players.length === 10) {
                throw new Error('Game full');
            }
            LobbyService.leaveGames(id);
            players.push(userId);
            notifyObservers('join', game, logger);
            notifyObservers('change', game, logger);
            logger.log('verbose', `${UserService.getUserName(userId)} joined ${game.id}`);
        },

        /**
         * Begins lobby game if there are enough players, and removes the entry from
         * the lobby. A `gamestart` event will be fired with the game details
         */
        startGame: (userId) => {
            const index = games.findIndex(({host}) => host === userId);
            if(index === -1) {
                throw new Error('User not hosting a game');
            }
            const game = games.splice(index, 1)[0];
            notifyObservers('gamestart', game, logger);
            notifyObservers('change', game, logger);
            logger.log('verbose', `${UserService.getUserName(userId)} started game ${game.id}`);
        },

        /**
         * Registers an event listener for the given event type
         */
        addEventListener: (type, handler) => {
            if(!EVENT_TYPES.includes(type)) {
                throw new Error(`Unrecognized event type: ${type}`);
            }
            eventHandlers.push({
                type,
                handler
            });
        },

        /**
         * Removes the specified event listener
         */
        removeEventListener: (targetType, targetHandler) => {
            const index = eventHandlers.type(({type, handler}) =>
                type === targetType && handler === targetHandler
            );
            if(index === -1) {
                throw new Error('Handler not found');
            }
            eventHandlers.splice(index, 1);
        }
    };
    return LobbyService;
};
