'use strict';

const EventEmitter = require('eventemitter2').EventEmitter2;
const { URL } = require('url');
const { toIp, fromIp } = require('network-interfaces');


class PeerMessenger extends EventEmitter {
	constructor(network, address) {
		super();

		this.address = address;
		this.network = network;
	}

	receiveMessage(serialized) {
		const args = this.network._deserialize(serialized);

		this.emit(...args);
	}

	send(toAddress, ...args) {
		const serialized = this.network._serialize(...args);

		this.network.send(toAddress, serialized);
	}

	async destroy() {
		this.network.forgetAddress(this.address);

		await this.network.emitAsync('unsubscribe', this.address);
	}
}


class PeerNetwork extends EventEmitter {
	constructor({ log }, options) {
		super();

		this.log = log;

		this.protocol = options.protocol || 'tcp';
		this.interface = options.interface || fromIp(options.address, { ipVersion: 4 });
		this.address = options.address || toIp(options.interface, { ipVersion: 4 });
		this.port = options.port || '*';

		this._send = null;
		this._serialize = options.serialize;
		this._deserialize = options.deserialize;
		this._messengers = {};
	}

	setMyUri(uri) {
		const url = new URL(uri);

		this.protocol = url.protocol;
		this.interface = fromIp(url.hostname, { ipVersion: 4 });
		this.address = url.hostname;
		this.port = parseInt(url.port, 10);
	}

	getMyUri() {
		return `${this.protocol}://${this.address}:${this.port}`;
	}

	async createMessenger(address) {
		const messenger = new PeerMessenger(this, address);
		this._messengers[address] = messenger;

		await this.emitAsync('subscribe', address);

		return messenger;
	}

	setMessageSender(fn) {
		this._send = fn;
	}

	receiveMessage(toAddress, serialized) {
		const messenger = this._messengers[toAddress];

		if (messenger) {
			this.log.debug('[peer-network] Delivering message to "%s" of message: %s', toAddress, serialized);

			messenger.receiveMessage(serialized);
		}
	}

	managesAddress(address) {
		return this._messengers.hasOwnProperty(address);
	}

	forgetAddress(address) {
		delete this._messengers[address];
	}

	send(toAddress, serialized) {
		if (this._messengers[toAddress]) {
			setImmediate(() => {
				// make sure we are *still* managing this address after this tick

				const messenger = this._messengers[toAddress];

				if (messenger) {
					this.log.debug('[peer-network] Sending message in-memory to "%s": %s', toAddress, serialized);

					messenger.receiveMessage(serialized);

					this.emit('sent', { toAddress, serialized, inMemory: true });
				} else {
					this.log.debug('[peer-network] Sending message over network to "%s": %s', toAddress, serialized);

					this._send(toAddress, serialized);

					this.emit('sent', { toAddress, serialized, inMemory: false });
				}
			});
		} else {
			this.log.debug('[peer-network] Sending message over network to "%s": %s', toAddress, serialized);

			this._send(toAddress, serialized);

			this.emit('sent', { toAddress, serialized, inMemory: false });
		}
	}
}

exports.create = function (apis, options) {
	return new PeerNetwork(apis, options);
};
