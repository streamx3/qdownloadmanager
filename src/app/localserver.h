#pragma once
#include <QLocalServer>
#include <QLocalSocket>
#include <QHash>
#include "appcontroller.h"

class LocalServer : public QObject {
    Q_OBJECT
public:
    explicit LocalServer(AppController &controller, QObject *parent = nullptr);
    ~LocalServer() override;
    void shutdown();
    bool listen(const QString &name);
    QString errorString() const { return m_server.errorString(); }
private:
    struct Client { QByteArray buffer; QString owner; bool ready = false; };
    void read(QLocalSocket *socket);
    void updateCount();
    AppController &m_controller;
    QLocalServer m_server;
    QHash<QLocalSocket *, Client> m_clients;
};
