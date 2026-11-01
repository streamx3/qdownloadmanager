#pragma once
#include <QAbstractListModel>
#include <QVariantList>

// Stable rows keep focus and pressed buttons intact while progress changes.
class DownloadListModel : public QAbstractListModel {
    Q_OBJECT
public:
    explicit DownloadListModel(QObject *parent = nullptr) : QAbstractListModel(parent) {}
    int rowCount(const QModelIndex &parent = {}) const override { return parent.isValid() ? 0 : int(m_rows.size()); }
    QVariant data(const QModelIndex &index, int role) const override;
    QHash<int, QByteArray> roleNames() const override { return {{Qt::UserRole, "modelData"}}; }
    void update(const QVariantList &rows);
private:
    QVariantList m_rows;
};
