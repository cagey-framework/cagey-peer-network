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
	constructor(options) {
		super();

		this.protocol = options.protocol || 'tcp';
		this.interface = options.interface || fromIp(options.address);
		this.address = options.address || toIp(options.interface);
		this.port = options.port || '*';

		this._serialize = options.serialize;
		this._deserialize = options.deserialize;
		this._messengers = {};
	}

	setMyUri(uri) {
		const url = new URL(uri);

		this.protocol = url.protocol;
		this.interface = fromIp(url.hostname);
		this.address = url.hostname;
		this.port = parseInt(url.port, 10);
	}

	getMyUri() {
		return `${this.protocol}://${this.address}:${this.port}`;
	}

	async createMessenger(address) {
		const messenger = new PeerMessenger(this, address);
		this.messengers[address] = messenger;

		await this.emitAsync('subscribe', address);

		return messenger;
	}

	setMessageSender(fn) {
		this._send = fn;
	}

	receiveMessage(address, serialized) {
		const messenger = this.messengers[address];

		if (messenger) {
			messenger.receiveMessage(serialized);
		}
	}

	managesAddress(address) {
		return this.messengers.hasOwnProperty(address);
	}

	forgetAddress(address) {
		delete this.messengers[address];
	}

	send(toAddress, serialized) {
		if (this.messengers[toAddress]) {
			setImmediate(() => {
				// make sure we are *still* managing this address after this tick

				const messenger = this.messengers[toAddress];

				if (messenger) {
					messenger.receiveMessage(serialized);

					this.emit('sent', { toAddress, serialized, inMemory: true });
				} else {
					this._send(toAddress, serialized);

					this.emit('sent', { toAddress, serialized, inMemory: false });
				}
			});
		} else {
			this._send(toAddress, serialized);

			this.emit('sent', { toAddress, serialized, inMemory: false });
		}
	}
}

exports.create = function (options) {
	return new PeerNetwork(options);
};
