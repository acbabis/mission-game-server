const shortid = require('shortid');

// Event for which listeners can be registered
const EVENT_TYPES = [
    'start',
    'end',
    'update',
    'cancel'
];

// Sequences of round-to-round mission sizes, based on player count
const MISSION_SIZES = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5]
};

// Map of bad guy counts, based on player count
const BAD_GUY_COUNTS = {
    5: 2,
    6: 2,
    7: 3,
    8: 3,
    9: 3,
    10: 4
};

// A game can be in one of four states
const STATE_NOMINATION = 'nomination';
const STATE_VOTE = 'vote';
const STATE_MISSION = 'mission';
const STATE_END = 'end';

// Generates an array of random unique values in the range
// of 0 to n-1. Example: randIndexArray(5, 2) might return [4, 2]
const randIndexArray = (size, count) => {
    const pool = new Array(size).fill(null).map((u,i) => i);
    return new Array(count).fill(null).map(() => {
        const index = Math.floor(Math.random() * pool.length);
        return pool.splice(index, 1)[0];
    });
};

module.exports = (UserService, logger) => {
    const games = [];

    // Notifies registered (external) event listeners of an event
    const eventHandlers = [];
    const notifyObservers = (type, event) => {
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
    return {
        /**
         * Gets a list of IDs of games the given player is currently participating
         */
        getGamesFor: (playerId) => {
            return games.filter(({players}) => players.includes(playerId))
                .map(({id}) => id);
        },

        /**
         * Starts a new game with the given list of players
         */
        startGame: (players) => {
            const badFactionSize = BAD_GUY_COUNTS[players.length];
            const badFaction = randIndexArray(players.length, badFactionSize);
            const succession = randIndexArray(players.length, players.length);
            const game = {
                id: shortid.generate(),
                state: STATE_NOMINATION,
                players,
                badFaction,
                succession,
                missionHistory: []
            };
            games.push(game);
            notifyObservers('start', game);
        },

        /**
         * Applies a given move to the game state
         */
        applyMove: (gameId, playerId, move) => {
            const game = games.find(({id}) => id === gameId);
            if(!game) {
                throw new Error('No game with given ID');
            }
            if(!game.players.includes(playerId)) {
                throw new Error('Player not in game');
            }
            const {
                state, players, succession, missionHistory,
                currentVotes, currentMissionGroup, currentMissionSuccesses
            } = game;
            const {nominations, approve, succeed} = move;

            const currentRound = missionHistory.length;
            const numOnMission = MISSION_SIZES[players.length][currentRound];
            const playerName = UserService.getUserName(playerId);
            const playerIndex = players.indexOf(playerId);

            switch(state) {
            case STATE_NOMINATION: {
                if(players[succession[0]] !== playerId) {
                    throw new Error('Illegal player making nomination');
                }
                const nominationCheck = {};
                nominations.forEach(value => {
                    if(typeof value !== 'number') {
                        throw new Error('Illegal nomination');
                    }
                    nominationCheck[value] = true;
                });
                if(Object.keys(nominationCheck).length !== numOnMission) {
                    throw new Error('Illegal nomination count');
                }
                logger.log('verbose', `${game.id}: ${playerName} nominated ${nominations.map(index => UserService.getUserName(players[index])).join(', ')}`);
                game.state = STATE_VOTE;
                game.currentNominations = nominations;
                game.currentVotes = {};
                notifyObservers('update', game);
                break;
            }
            case STATE_VOTE: {
                if(typeof approve !== 'boolean') {
                    throw new Error('"approve" must be a boolean"');
                }
                currentVotes[players.indexOf(playerId)] = approve;
                logger.log('verbose', `${game.id}: ${playerName} ${approve ? 'approved' : 'rejected'} nomination`);
                const isVoteArrayFull = new Array(players.length).fill(null).every((u, index) => typeof currentVotes[index] === 'boolean');
                if(isVoteArrayFull) {
                    logger.log('verbose', `${game.id}: all votes placed`);
                    const approveCount = Object.values(currentVotes).reduce((a, b) => a + b, 0);
                    if(approveCount >= players.length / 2) {
                        game.state = STATE_MISSION;
                        game.currentMissionGroup = game.currentNominations;
                        game.currentMissionSuccesses = {};
                        logger.log('verbose', `${game.id}: vote passes`);
                    } else {
                        game.state = STATE_NOMINATION;
                        succession.push(succession.shift());
                        logger.log('verbose', `${game.id}: vote fails`);
                        const nextLeader = UserService.getUserName(players[succession[0]]);
                        logger.log('verbose', `${game.id}: ${nextLeader} is next leader`);
                    }
                    delete game.currentNominations;
                    game.lastVote = currentVotes;
                }
                notifyObservers('update', game);
                break;
            }
            case STATE_MISSION: {
                if(!currentMissionGroup.includes(playerIndex)) {
                    throw new Error('Player not on mission');
                }
                if(typeof succeed !== 'boolean') {
                    throw new Error('"succeed" must be a boolean');
                }
                currentMissionSuccesses[playerIndex] = succeed;
                logger.log('verbose', `${game.id}: ${playerName} selects ${succeed ? 'succeed' : 'fail'} for the current mission`);
                if(Object.keys(currentMissionSuccesses).length === numOnMission) {
                    logger.log('verbose', `${game.id}: all mission actions placed`);
                    const numFails = Object.values(currentMissionSuccesses).reduce((sum, success) => sum + !success, 0);
                    const failsRequired = (players.length >= 7 && currentRound === 3) ? 2 : 1;
                    const isFailure = numFails >= failsRequired;
                    logger.log('verbose', `${game.id}: mission ${isFailure ? 'failed' : 'successful'}`);

                    missionHistory.push({
                        numFails,
                        isFailure
                    });
                    delete game.currentMissionGroup;
                    delete game.currentMissionSuccesses;

                    const numFailedMissions = missionHistory.map(({isFailure}) => +isFailure).reduce((a, b) => a + b, 0);
                    const numSuccessfulMissions = missionHistory.length - numFailedMissions;

                    if(numFailedMissions === 3) {
                        logger.log('verbose', `${game.id}: game ended in defeat`);
                        game.state = STATE_END;
                    } else if(numSuccessfulMissions === 3) {
                        logger.log('verbose', `${game.id}: game ended in success`);
                        game.state = STATE_END;
                    } else {
                        game.state = STATE_NOMINATION;
                        succession.push(succession.shift());
                        const nextLeader = UserService.getUserName(players[succession[0]]);
                        logger.log('verbose', `${game.id}: ${nextLeader} is next leader`);
                    }
                }
                notifyObservers('update', game);
                break;
            }
            }
        },

        /**
         * Gets a subset of a given game's state with information
         * relevant and authorized for the given player
         */
        getPlayerGameInfo: (gameId, playerId) => {
            const game = games.find(({id}) => id === gameId);
            if(!game) {
                throw new Error('No game with given ID');
            }
            if(!game.players.includes(playerId)) {
                throw new Error('Player not in game');
            }
            const {
                id, state, players, badFaction, succession,
                currentNominations, currentVotes, currentMissionGroup,
                currentMissionSuccesses, lastVote, missionHistory
            } = game;

            const playerIndex = players.indexOf(playerId);
            const isBad = badFaction.includes(playerIndex);

            const substate = {
                id,
                playerIndex,
                state,
                players,
                badFaction: isBad ? badFaction : undefined,
                succession,
                lastVote: lastVote ? Object.assign({}, lastVote) : undefined,
                missionHistory: missionHistory.slice()
            };

            switch(state) {
            case STATE_NOMINATION: {
                substate.nextMissionSize = MISSION_SIZES[players.length][missionHistory.length];
                break;
            }
            case STATE_VOTE: {
                substate.currentNominations = currentNominations.slice();
                substate.hasMadeSelection = typeof currentVotes[playerIndex] === 'boolean';
                break;
            }
            case STATE_MISSION: {
                substate.currentMissionGroup = currentMissionGroup.slice();
                if(currentMissionGroup.includes(playerIndex)) {
                    substate.hasMadeSelection = typeof currentMissionSuccesses[playerIndex] === 'boolean';
                }
                break;
            }
            case STATE_END: {
                // At the end of the game, roles are revealed
                substate.badFaction = badFaction;
                break;
            }
            }

            return substate;
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
};