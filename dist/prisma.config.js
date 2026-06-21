"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("@prisma/config");
exports.default = (0, config_1.defineConfig)({
    datasource: {
        url: 'file:./dev.db',
    },
});
//# sourceMappingURL=prisma.config.js.map