#include "identity.h"
#include "localendpoint.h"
#include "protocol.h"
#include <QCoreApplication>
#include <QElapsedTimer>
#include <QLocalSocket>
#include <cstdio>
#include <cstring>
#ifdef Q_OS_WIN
#include <fcntl.h>
#include <io.h>
#endif

namespace {
bool readExact(char *data, size_t size)
{
    while (size) {
        const auto count = std::fread(data, 1, size, stdin);
        if (!count) return false;
        data += count;
        size -= count;
    }
    return true;
}
bool send(const QJsonObject &object)
{
    const auto data = Protocol::frame(object);
    return !data.isEmpty() && std::fwrite(data.constData(), 1, size_t(data.size()), stdout) == size_t(data.size()) && std::fflush(stdout) == 0;
}
QJsonObject exchange(QLocalSocket &socket, const QJsonObject &request)
{
    const auto outgoing = Protocol::frame(request);
    if (socket.write(outgoing) != outgoing.size()) return {};
    while (socket.bytesToWrite()) if (!socket.waitForBytesWritten(3000)) return {};
    QByteArray buffer;
    QElapsedTimer timer;
    timer.start();
    while (timer.elapsed() < 10000) {
        if (!socket.bytesAvailable() && !socket.waitForReadyRead(int(10000 - timer.elapsed()))) return {};
        buffer += socket.readAll();
        if (buffer.size() > Protocol::MaxFrame + 4) return {};
        QJsonObject reply;
        QString error;
        if (!Protocol::take(buffer, reply, error)) return {};
        if (!reply.isEmpty()) return reply;
    }
    return {};
}
}

int main(int argc, char *argv[])
{
    QCoreApplication app(argc, argv);
    QCoreApplication::setOrganizationName("QDownloadManager");
    QCoreApplication::setApplicationName("DownloadHelper");
#ifdef Q_OS_WIN
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    const auto expectedOrigin = QString("chrome-extension://%1/").arg(Identity::ExtensionId);
    if (app.arguments().size() < 2 || app.arguments().at(1) != expectedOrigin) {
        std::fprintf(stderr, "This bridge must be launched by the Download Helper Chrome extension.\n");
        return 1;
    }
    // Explicit override lets integration tests isolate both processes without touching user data.
    const auto dataDirectory = qEnvironmentVariable("QDM_DATA_DIR", LocalEndpoint::dataDirectory());
    const auto endpoint = LocalEndpoint::name(dataDirectory);
    QLocalSocket socket;
    socket.setReadBufferSize(Protocol::MaxFrame + 4);
    while (true) {
        quint32 length;
        if (!readExact(reinterpret_cast<char *>(&length), 4)) break;
        if (!length || length > Protocol::MaxFrame) { std::fprintf(stderr, "Invalid native message length.\n"); return 2; }
        QByteArray buffer(4 + length, Qt::Uninitialized);
        std::memcpy(buffer.data(), &length, 4);
        if (!readExact(buffer.data() + 4, length)) return 2;
        QJsonObject request;
        QString error;
        if (!Protocol::take(buffer, request, error) || !Protocol::validRequest(request)) {
            if (!send(Protocol::failure(request, "invalid_request", "Expected a valid protocol v1 message."))) break;
            continue;
        }
        if (socket.state() != QLocalSocket::ConnectedState) {
            socket.abort();
            if (!endpoint.isEmpty()) socket.connectToServer(endpoint);
            if (endpoint.isEmpty() || !socket.waitForConnected(750)) {
                if (!send(Protocol::failure(request, "app_not_running", "Open Download Helper on this computer, then try again."))) break;
                continue;
            }
            // Every new local connection starts with a handshake, including reconnects.
            const auto hello = exchange(socket, {{"v", 1}, {"id", "bridge-hello"}, {"type", "hello"}});
            if (!hello.value("ok").toBool()) socket.abort();
        }
        auto reply = socket.state() == QLocalSocket::ConnectedState ? exchange(socket, request) : QJsonObject{};
        if (reply.isEmpty()) {
            socket.abort();
            reply = Protocol::failure(request, "app_disconnected", "The desktop app disconnected. Open it and try again.");
        }
        if (!send(reply)) break;
    }
    socket.abort();
    return 0;
}
