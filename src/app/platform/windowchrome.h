// SPDX-License-Identifier: MIT
// Adapted from Dr Stein's window_chrome; see third_party/dr_stein/LICENSE.
#pragma once
#include <QObject>
#include <QVariantMap>
#include <QWindow>

class WindowChrome : public QObject {
    Q_OBJECT
    Q_PROPERTY(int leftInset READ leftInset CONSTANT)
    Q_PROPERTY(bool nativeButtons READ nativeButtons CONSTANT)
public:
    explicit WindowChrome(QObject *parent = nullptr) : QObject(parent) {}
    int leftInset() const;
    bool nativeButtons() const;
    Q_INVOKABLE void attach(QWindow *window);
    Q_INVOKABLE void setDark(QWindow *window, bool dark);
    Q_INVOKABLE QVariantMap metrics(QWindow *window) const;
};
