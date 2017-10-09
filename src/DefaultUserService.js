const users = {};

const getUser = (id) => {
    return users[id] || (users[id] = {id});
};

// TODO: Come up with a better interface
// TODO: Consider making async
module.exports = (logger) => ({
    setUserName: (id, name) => {
        if(typeof name !== 'string' || name.length > 40) {
            throw new Error(`Illegal name ${name}`);
        }
        getUser(id).name = name;
    },
    getUserName: (id) => getUser(id).name,
    getPublicUserData: () => Object.values(users).map(({name}) => ({name})),
    handleLogout: (id) => delete users[id]
});