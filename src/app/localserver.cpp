#include "localserver.h"
#include "protocol.h"
#include <QTimer>
#include <QUuid>

LocalServer::LocalServer(AppController &controller, QObject *parent) : QObject(parent), m_controller(controller)
{
    m_server.setSocketOptions(QLocalServer::UserAccessOption);
    m_server.setMaxPendingConnections(8);
    connect(&m_server, &QLocalServer::newConnection, this, [this] {
        while (auto socket = m_server.nextPendingConnection()) {
            if (m_clients.size() >= 8) { socket->abort(); socket->deleteLater(); continue; }
            socket->setReadBufferSize(Protocol::MaxFrame + 4);
            m_clients.insert(socket, {{}, QUuid::createUuid().toString(), false});
            connect(socket, &QLocalSocket::readyRead, this, [this, socket] { read(socket); });
            connect(socket, &QLocalSocket::disconnected, this, [this, socket] {
                m_controller.disconnectOwner(m_clients.value(socket).owner);
                m_clients.remove(socket);
                socket->deleteLater();
                updateCount();
            });
            QTimer::singleShot(5000, socket, [this, socket] {
                if (m_clients.contains(socket) && !m_clients.value(socket).ready) socket->disconnectFromServer();
            });
        }
    });
}

LocalServer::~LocalServer() { shutdown(); }

void LocalServer::shutdown()
{
    // QLocalServer owns accepted sockets. Disconnect their callbacks before the
    // client table is destroyed; a socket's destructor can emit disconnected().
    const auto sockets = m_clients.keys();
    for (auto socket : sockets) {
        QObject::disconnect(socket, nullptr, this, nullptr);
        const auto owner = m_clients.value(socket).owner;
        socket->abort();
        delete socket;
        m_controller.disconnectOwner(owner);
    }
    m_clients.clear();
    m_server.close();
    updateCount();
}

bool LocalServer::listen(const QString &name)
{
    if (name.isEmpty()) return false;
    // main() holds the instance lock before removing a stale endpoint.
    QLocalServer::removeServer(name);
    return m_server.listen(name);
}

void LocalServer::updateCount()
{
    int count = 0;
    for (const auto &client : m_clients) if (client.ready) ++count;
    m_controller.setBrowserCount(count);
}

void LocalServer::read(QLocalSocket *socket)
{
    if (!m_clients.contains(socket)) return;
    auto &client = m_clients[socket];
    client.buffer += socket->readAll();
    if (client.buffer.size() > Protocol::MaxFrame + 4 || socket->bytesToWrite() > Protocol::MaxFrame) { socket->abort(); return; }
    while (true) {
        QJsonObject request;
        QString error;
        if (!Protocol::take(client.buffer, request, error)) { socket->abort(); return; }
        if (request.isEmpty()) return;
        if (!client.ready) {
            if (!Protocol::validRequest(request) || request.value("type") != "hello") { socket->disconnectFromServer(); return; }
            client.ready = true;
            updateCount();
        }
        socket->write(Protocol::frame(m_controller.handle(request, client.owner)));
    }
}
